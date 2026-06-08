interface IHeadingProps {
  children: React.ReactNode;
}

const Heading = (props: IHeadingProps) => {
  const { children } = props;

  return <h1 id="heading">{children}</h1>;
};

export default Heading;
